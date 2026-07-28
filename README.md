# claudefs

Connect a local folder to [claude.ai](https://claude.ai). A Chrome extension (MV3): authorize a folder once, and Claude can read, search, and edit the files in it right from the chat — no desktop app, no API key, no command line.

[English](#english) | [中文](#中文)

## English

### Install & Use

1. Load the extension (Developer mode → "Load unpacked").
2. Open [claude.ai](https://claude.ai).
3. Click the connect button at the bottom right of the page and pick a local folder.
4. Ask Claude something like "read xx file" — that's it.

> Tip: the file tools only appear in Claude's available tool list after it discovers them — if Claude doesn't use the tools at first, rephrase and mention file operations explicitly.

### Privacy

All file operations run locally in your browser; the extension itself sends nothing to any server. File content that Claude reads via the tools goes only into your claude.ai conversation — the same as if you had pasted or uploaded it there yourself. Your folder reference is stored only in the browser's local storage (IndexedDB). Full policy: [PRIVACY.md](./PRIVACY.md).

### Safety

Every write operation (write / edit / move / delete, etc.) shows a diff confirmation dialog before touching your disk — you review the change and decide whether to approve it.

### Disclaimer

claudefs is an independent open-source project, not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic.

### License

MIT — see [LICENSE](./LICENSE).

## 中文

一个 Chrome 扩展（MV3），让你在 [claude.ai](https://claude.ai) 授权一个本地文件夹后，Claude 能像 agent 一样直接读写该文件夹里的文件——零安装、无 API Key、无命令行。

### 安装与使用

1. 加载本扩展（开发者模式加载已解压的扩展程序）。
2. 打开 [claude.ai](https://claude.ai)。
3. 点击页面右下角的连接按钮，选择要授权的本地文件夹。
4. 对 Claude 说"读一下 xx 文件"之类的话即可。

> 提示：文件工具需要 Claude 先检索到，才会出现在它当次对话可用的工具列表里——如果它一开始没用工具，换个更明确提到文件操作的说法再试一次。

### 隐私

所有文件操作都在你本地浏览器完成，扩展自身不向任何服务器传输任何数据；Claude 通过工具读到的文件内容，只会进入你正在使用的 claude.ai 对话（等同于你手动粘贴/上传给 Claude）。你选的文件夹引用仅保存在浏览器本地存储（IndexedDB）中。完整政策见 [PRIVACY.md](./PRIVACY.md)。

### 安全

所有写操作（write / edit / move / delete 等）执行前都会弹出 diff 确认，你可以查看改动内容后再决定是否放行。

### 免责声明

本项目并非 Anthropic 官方产品，与 Anthropic 无关联、未获其背书。Claude 是 Anthropic 的商标。

### License

MIT，见 [LICENSE](./LICENSE)。
