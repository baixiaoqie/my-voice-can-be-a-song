// config.js —— 配置字段校验模块（#6 鲁棒性：自定义上传/加载前的字段校验）
// 供网页端在 $.parseJSON 之后、实际使用之前做基本结构校验，
// 返回 null 表示通过，返回字符串表示错误信息。

export function validateVocal(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return '配置不是有效的 JSON 对象';
    }
    if (!json.media || typeof json.media !== 'object') {
        return '缺少 media 媒体列表';
    }
    return null;
}

export function validateMusic(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return '配置不是有效的 JSON 对象';
    }
    if (!json.media || typeof json.media !== 'object') {
        return '缺少 media 媒体列表';
    }
    if (!Array.isArray(json.tracks)) {
        return '缺少 tracks 音轨列表';
    }
    return null;
}
