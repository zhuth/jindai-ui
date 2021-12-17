import axios from 'axios'
import api from '../api'

const _BASE = '/api/gallery'

export default {
    _loading: [],
    bus: api.bus,

    load_config(name, defaults = {}) {
        var s = localStorage[name]
        if (s) Object.assign(defaults, JSON.parse(s))
        return defaults
    },

    save_config(name, config) {
        localStorage[name] = JSON.stringify(config);
    },

    call(name, data, method = 'post', show_loading = true, cancel = null) {
        var key = new Date().toJSON() + Math.random()
        if (show_loading) this._loading.push(key)
        this.bus.$emit('loading', this._loading.length)
        return axios[method](`${_BASE}/${name}`, data, cancel ? { cancelToken: cancel.token } : {}).then(resp => {
            if (show_loading) this._loading.splice(this._loading.indexOf(key), 1)
            this.bus.$emit('loading', this._loading.length)
            if (resp.data.exception) {
                console.log(resp.data)
                throw new Error(resp.data.exception)
            }
            return resp.data
        }).catch(err => {
            if (show_loading) this._loading.splice(this._loading.indexOf(key), 1)
            this.bus.$emit('loading', this._loading.length)
            if (err.__CANCEL__) return
            console.log('Error', err)
            this.bus.$emit('alert', err.exception || err)
            throw err
        })
    },

    cancel_source: api.cancel_source,

    fetch(params, cancel) {
        return this.call('get', params, 'post', true, cancel).then(data => {
            if (!data) return;
            if (data.redirect) {
                location.href = data.redirect
            }
            data.results = data.results.map(album => {
                album.author = album.author || (album.keywords.filter(x => x.startsWith('@')) || [''])[0]
                album.group = album.group_id ? '?query=' + album.group_id : '?query=id%3D' + album._id
                album.selected = false
                album.items.forEach(i => { i.rating = i.rating || 0 })
                return album
            })
            return data
        })
    },

    get_item_image(item, config = {}) {

        if (typeof item === "undefined" || !item.source.url)
            return "https://via.placeholder.com/350x150.png?text=No Image";

        var ext = item.source.url.split(".").pop();
        if (ext === "mp4") {
            if (item.thumbnail) return `/api/image/imageitem/${item.thumbnail}`;
            return "https://via.placeholder.com/350x150.png?text=Video";
        }
        if (config.force_thumbnail) {
            if (ext.indexOf('?') < 0) ext += '?'
            else ext += '&'
            ext += "w=1280";
        }
        if (config.enhance) {
            if (ext.indexOf('?') < 0) ext += '?'
            else ext += '&'
            ext += 'enhance=1'
        }
        if (item.source.file) return `/api/image/imageitem/${item._id}.${ext}`;
        return item.source.url;
    },

    get_item_video(item) {
        if (item.source.file) return `/api/image/imageitem/${item._id}.mp4`;
        return `${_BASE}/${item.source.url}`;
    },

    quote(tag) {
        tag = tag || '';
        if (tag.match(/[`'"()\s.,+%:/]/)) return "`" + tag.replace(/`/g, "\\`") + "`";
        return tag;
    }
}