# Privacy Policy / 隐私政策

_Last updated: 2026-07-27_

## English

**claudeFS** is a Chrome extension that connects a user-authorized local folder to claude.ai so Claude can read and edit files in it during conversation.

**Data collection: none.** The extension does not collect, store, transmit, sell, or share any user data with the developer or any third party. There are no analytics, no telemetry, no remote servers operated by this project.

**How your files are handled:**

- All file operations run locally in your browser, using the browser's File System Access API, and only within the single folder you explicitly authorize via the system folder picker.
- File content that Claude reads via the tools becomes part of your claude.ai conversation — exactly as if you had pasted or uploaded it there yourself. It is subject to Anthropic's own privacy policy, which this project does not control.
- Every write operation (write / edit / move / delete, etc.) requires your explicit approval in a diff confirmation dialog before anything touches your disk.

**Local storage:** the only thing the extension persists is a reference (handle) to the folder you selected, stored in your browser's local IndexedDB so you don't have to re-pick the folder every time. It never leaves your machine. Removing the extension or clearing site data deletes it.

**Permissions:** the extension requests a single host permission for `claude.ai` (required to run on that site) and no other Chrome permissions.

**Contact:** vincentping@gmail.com

## 中文

**claudeFS** 是一个 Chrome 扩展，把你授权的本地文件夹接入 claude.ai，让 Claude 能在对话中读写其中的文件。

**数据收集：无。** 扩展不收集、不存储、不传输、不出售、不共享任何用户数据给开发者或任何第三方。没有统计埋点、没有遥测、本项目不运营任何远程服务器。

**你的文件如何被处理：**

- 所有文件操作都在你的浏览器本地完成（基于浏览器 File System Access API），且仅限你通过系统文件夹选择器显式授权的那一个文件夹。
- Claude 通过工具读到的文件内容会进入你的 claude.ai 对话——等同于你手动粘贴或上传给它，适用 Anthropic 自己的隐私政策（不受本项目控制）。
- 所有写操作（写入/编辑/移动/删除等）都必须经你在 diff 确认框中明确批准后才会落盘。

**本地存储：** 扩展唯一持久化的数据是你所选文件夹的引用（handle），存在浏览器本地 IndexedDB 中，用途是免去每次重新选择文件夹。它不会离开你的电脑；卸载扩展或清除站点数据即删除。

**权限：** 扩展仅申请 `claude.ai` 一个站点权限（在该站点运行所必需），无其它任何 Chrome 权限。

**联系方式：** vincentping@gmail.com
