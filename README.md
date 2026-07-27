# claudefs

一个 Chrome 扩展（MV3），让你在 [claude.ai](https://claude.ai) 授权一个本地文件夹后，Claude 能像 agent 一样直接读写该文件夹里的文件——零安装、无 API Key、无命令行。

## 安装与使用

1. 加载本扩展（开发者模式加载已解压的扩展程序）。
2. 打开 [claude.ai](https://claude.ai)。
3. 点击页面右下角的连接按钮，选择要授权的本地文件夹。
4. 对 Claude 说"读一下 xx 文件"之类的话即可。

> 提示：文件工具需要 Claude 先检索到，才会出现在它当次对话可用的工具列表里——如果它一开始没用工具，换个更明确提到文件操作的说法再试一次。

## 隐私

所有文件操作都在你本地浏览器完成，不向任何服务器传输文件内容；仅用 `chrome.storage` 在本地保存你选的文件夹引用。

## 安全

所有写操作（write / edit / move / delete 等）执行前都会弹出 diff 确认，你可以查看改动内容后再决定是否放行。

## 免责声明

本项目并非 Anthropic 官方产品，与 Anthropic 无关联、未获其背书。Claude 是 Anthropic 的商标。

## License

MIT，见 [LICENSE](./LICENSE)。
