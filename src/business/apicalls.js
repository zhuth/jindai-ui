import Vue from "vue";
import api from "../api";
import dialogs from "../dialogs";
import i18n from "../locales";
import { customAlphabet } from 'nanoid'

const tempgroup = customAlphabet('1234567890abcdef', 10)
const shortcut_choices = []
const plugin_pages = []
const languages = {}
const pipelines = {}


const promise = Promise.all([
  api.call("plugins/shortcuts").then((data) => {
    shortcut_choices.push(...data.result.map((k) => ({
      text: `${k.name} ${k.expr}`,
      value: k.expr,
    })));
  }),

  api
    .call("plugins/filters")
    .then((data) => (plugin_pages.push(...data.result))),

  api.call("help/pipelines").then(data => {
    Object.assign(pipelines, data.result);
  }),

  api.call("help/langs").then(data => {
    Object.assign(languages, data.result);
  })]).then(() => {
    Object.assign(Vue.prototype.business, {
      match_shortcuts(search, vm) {
        let value = vm.new_value;
        return new Promise((accept) => {
          if (!search) accept([]);
          var matched = shortcut_choices.filter((x) =>
            x.text.startsWith(search)
          );
          if (matched.length > 0 && matched[0].text.startsWith(search + " ")) {
            if (!value.includes(matched[0])) value.push(matched[0]);
            if (matched.length == 1) vm.typing = "";
            else vm.typing = search;
          }
          accept(matched);
        });
      },

      plugin_pages,
      languages,
      pipelines,

      tag(options) {
        const { selection, val: tags, append } = options
        var existing_tags = new Set(
          selection.paragraphs.reduce((a, tags) => a.concat(tags.keywords), [])
        );
        var push = append ? tags : tags.filter((x) => !existing_tags.has(x)),
          pull = append
            ? []
            : Array.from(existing_tags).filter((x) => !tags.includes(x));
        var updates = {
          ids: selection.ids,
          $push: { keywords: push },
          $pull: { keywords: pull },
        };
        if (push.filter((x) => x.startsWith("@")))
          updates.author = push.filter((x) => x.startsWith("@"))[0];
        else if (pull.filter((x) => x.startsWith("@"))) updates.author = "";

        return api
          .call(
            `collections/${selection.first.mongocollection || "paragraph"}/batch`,
            updates
          )
          .then((data) => {
            selection.all.forEach((p) => {
              data.result[p._id] &&
                Object.assign(p, data.result[p._id], { images: p.images });
            });
          });
      },
      delete(options) {
        const { selection } = options
        var objs = selection.to_objects();
        return api
          .call("mediaitem/delete", {
            para_items: objs.para_items,
          })
          .then(() => {
            selection.all.forEach((paragraph) => {
              if (objs.visible_para_items[paragraph._id]) {
                paragraph.images = paragraph.images.filter(i => !objs.visible_para_items[paragraph._id].includes(i._id))
                paragraph.src = api.get_paragraph_image(paragraph)
              }
            });
          });
      },
      rating(options) {
        const { selection, ...rating } = options
        rating.ids = selection.items.map((x) => x._id);
        if (api.config.view_mode == "gallery") {
          return api.call("mediaitem/rating", rating).then((data) => {
            data = data.result || {};
            selection.all.forEach((p) =>
              p.images && p.images.forEach(
                (i) =>
                  typeof data[i._id] !== "undefined" && (i.rating = data[i._id])
              )
            );
          });
        } else {
          return Promise.all(selection.paragraphs.map((x) => api.fav(x)));
        }
      },
      group(options) {
        const { selection, del, advanced } = options
        var bundle = {
          ids: selection.ids,
          ungroup: del,
        };

        const _call = () => {
          return api
            .call(
              `collections/${selection.first.mongocollection || "paragraph"}/group`,
              bundle
            )
            .then((data) => {
              const { group_ids, paragraph_ids } = data.result
              selection.all.forEach(
                (p) =>
                  paragraph_ids.includes(p._id) ?
                    (p.keywords = p.keywords
                      .filter(
                        (x) =>
                          !x.match(del ? /^#/ : /^#0/) && !group_ids.includes(x)
                      )
                      .concat(group_ids)) : void (0)
              );
            });
        };

        const existing_groups = new Set(selection.paragraphs.map(
          p => p.keywords.filter(x => x.startsWith('#'))).reduce(
            (prev, current) => prev.concat(current)))
          
        if (
          !del && (advanced || existing_groups.length > 1)
        ) {
          var choices = Array.from(new Set([
            ...api.guess_groups(api.current_q()),
            ...api.guess_groups(selection.paragraphs),
          ])).sort();
          return dialogs
            .prompt({
              title: i18n.t("group"),
              choices,
              initial: choices[0] || "",
            })
            .then((group) => {
              bundle.group = (group || []).map((x) => x.replace(/^#/, ""));
              return _call();
            })
            .catch(() => {
              bundle.group = '';
              return _call();
            });
        } else {
          bundle.group = (Array.from(existing_groups)[0] || ('0' + tempgroup())).replace(/^#/,'')
          return _call();
        }
      },
      merge(options) {
        const { selection } = options

        var objs = selection.to_objects()
        if (!selection || !selection.length) return;
        return api
          .call(`collections/${selection.first.mongocollection || "paragraph"}/merge`, {
            paragraphs: objs.para_items,
          })
      },
      split(options) {
        const { selection } = options
        var objs = selection.to_objects()
        return api
          .call(`collections/${selection.first.mongocollection || "paragraph"}/split`, {
            paragraphs: objs.para_items,
          })
      },
      reset_storage(options) {
        const { selection } = options
        return api
          .call("mediaitem/reset_storage", {
            ids: selection.items.map((x) => x._id),
          })
      },

      interactive_tagging(options) {
        const { selection } = options
        var existing_tags = new Set(
          selection.paragraphs.reduce((a, tags) => a.concat(tags.keywords), [])
        );
        return dialogs
          .prompt({
            title: i18n.t("tagging"),
            value: Array.from(existing_tags),
            matcher: (search, vm) => { // search tag
              let value = vm.new_value;
              return new Promise((accept) => {
                if (vm.cancel) vm.cancel.cancel();
                if (search.length == 0 || search == "#" || search == "@") return [];
                vm.cancel = api.cancel_source();
                api
                  .call(
                    "term/keywords",
                    {
                      pattern: api.escape_regex(search),
                      regex: true,
                    },
                    vm.cancel
                  )
                  .then((data) => {
                    vm.cancel = null;
                    data = data || { result: [] };
                    var choices = value
                      .map((x) => ({
                        text: x,
                        value: x,
                      }))
                      .concat(
                        data.result.map((x) => ({
                          text: x.term,
                          value: x.term,
                        }))
                      );
                    accept(choices);
                  })
                  .catch((err) => {
                    vm.cancel = null;
                    console.log(err);
                  });
              });
            } // end of search tag
          })
          .then((tags) => {
            this.tag({ selection, val: tags, append: false });
          });
      },

      short_tagging(options) {
        const { selection, initial } = options
        return dialogs
          .prompt({
            title: i18n.t("tagging"),
            choices: shortcut_choices,
            matcher: this.match_shortcuts,
            allow_custom: false,
            initial,
          })
          .then((tags) => this.tag({ val: tags, append: true, selection }));
      },

      batch_tagging(options) {
        const { selection } = options
        return dialogs
          .batch_tagging(api.config.tagging || {})
          .then((tags) => this.tag({ selection, val: tags, append: true }));
      },

      author(options) {
        const { selection } = options
        var authors = new Set(
          selection.paragraphs
            .reduce((a, tags) => a.concat(tags.keywords), [])
        ),
          author = selection.first.author;
        return dialogs
          .prompt({
            title: i18n.t("author"),
            value: author ? [author] : [],
            choices: Array.from(authors).sort(),
            limit: 1,
            allow_custom: true,
            initial: authors[0] || author || "",
          })
          .then((authors) => {
            const author = authors[0]

            return api
              .call(`collections/${selection.first.mongocollection || "paragraph"}/batch`, {
                ids: selection.ids,
                author,
                $push: { keywords: author },
              })
              .then((data) => {
                selection.all.forEach((p) => {
                  data.result[p._id] && (p.author = data.result[p._id].author);
                });
                return data.result
              });
          });
      },

      task(options) {
        return dialogs.send_task(options);
      },

      open_window(options) {
        const { selection, formatter } = options
        let url = formatter({ selection })
        api.open_window(url, '_blank')
        return new Promise(accept => accept())
      },

      info_dialog(options) {
        const { selection } = options
        return dialogs.info({ target: selection.first })
      }
    })
    return Vue.prototype.business
  })


export default promise