(function (root) {
  function describe(error) {
    const message = error?.message || String(error), invalidated = /Extension context invalidated|context has been invalidated|extension has been updated/i.test(message);
    return { invalidated, message: invalidated ? '墨迹已更新，此页面仍在使用旧脚本。请先保留未保存输入，再刷新此页；已保存的标注不会删除。' : /Receiving end does not exist|Could not establish connection|message port closed/i.test(message) ? '插件连接暂时中断。请保留当前输入，稍后重试或刷新论文页面。' : message };
  }
  root.MojiRuntimeErrors = { describe }; if (typeof module !== 'undefined') module.exports = { describe };
})(globalThis);
