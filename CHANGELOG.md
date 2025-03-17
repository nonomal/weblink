# Changelog

All notable changes to this project will be documented in this file.

## [0.11.2] - 2025-03-17

### Improvements

- Improve the video loading experience 改善视频加载体验

## [0.11.1] - 2025-02-05

### New Features

- Add grid layout, support drag and resize 添加网格布局，支持拖动和调整大小

- Add pause file transfer feature 添加暂停文件传输功能

## [0.10.6] - 2025-01-26

### New Features

- Add video constraints modification 添加视频约束修改功能

### Bug Fixes

- Fix the video max bitrate not working 修复了视频最大比特率不工作的问题

## [0.10.5] - 2025-01-14

### Bug Fixes

- Fix the bug that the remote stream cannot be removed correctly 修复了远程流无法正确更新的问题

## [0.10.4] - 2025-01-05

### Improvements

- Improve the encryption performance when using crypto-js 优化使用 crypto-js 时的加密性能

## [0.10.3] - 2024-12-14

### New Features

- Screen Sharing: Add volume indicator 屏幕共享添加音量指示器

- Screen Sharing: Add Mute button 屏幕共享添加静音按钮

- Screen Sharing: Add media selection dialog 屏幕共享添加媒体选择对话框

- Screen Sharing: Add media constraints control 屏幕共享添加媒体约束控制

- Screen Sharing: Add global audio player 屏幕共享添加全局音频播放器

- Screen Sharing: Add fullscreen and pip mode 屏幕共享添加全屏和画中画模式

## [0.9.2] - 2024-12-09

### New Features

- Add starter message 添加开始指引

### Improvements

- Improve the UI of the client page 优化客户端页面 UI

- Improve the video message UI 优化视频消息 UI

## [0.8.0] - 2024-11-29

### New Features

- Add share file feature 添加分享文件功能

### Improvements

- Improve the connection stability 改善连接稳定性

- Automatically try to reconnect when the connection is lost 自动尝试重新连接

## [0.7.5] - 2024-11-26

### New Features

- Add progress display in file list 在文件列表中添加进度显示

- Add double click to preview file in file table, and request file when status is not_started or stopped in sync page 在文件表中添加双击预览文件功能，当状态为 not_started 或 stopped 时在同步页面请求文件

### Improvements

- Improve the input label style 优化输入标签样式

- Improve the file table status display 优化文件表的状态显示

- Improve the file processing function, now can abort the file processing 优化文件处理功能，现在可以中止文件处理

- Improve the chat interface for loading more message on scroll 优化消息滚动加载的聊天界面

### Bug Fixes

- Fix the bug that check ice server availability works incorrectly 修复了检查 ICE 服务器可用性不正确的问题

- Fix the bug that the file transfer status is displayed incorrectly when starting 修复了文件传输状态在开始时显示不正确的问题

## [0.6.5] - 2024-11-14

### New Features

- Add file sync feature, now you can get the files cached by the peer 添加文件同步功能，现在可以获取对方缓存的文件

- Add strong password generation function 添加强密码生成功能

### Improvements

- Improve the file search function 优化文件搜索功能

- Using crypto-js for encryption in non-secure contexts 在非安全上下文中使用 crypto-js 进行加密

- Add sender resume file feature 添加发送端恢复传输功能

- Improve the UI of sending message 优化消息的 UI

### Bug Fixes

- Fix the bug that the file chunk cannot be received when resuming 修复了续传时文件区块接收的问题

- Fix the bug that messageChannel is undefined 修复了 messageChannel 未定义的问题

## [0.5.0] - 2024-11-04

### New Features

- Add Share Target API support, you can share files to Weblink from other apps 添加 Share Target API 支持，可以从其他应用分享文件到 Weblink

- Add forward menu option in file table 在文件表中添加转发菜单选项

### Bug Fixes

- Fix some i18n issues 修复一些 i18n 问题

## [0.4.1] - 2024-11-03

### New Features

- Add redirect option after connection in client menu 在客户端菜单中添加连接后重定向选项

- QR code dialog now displays your name 二维码对话框现在会显示自己的用户名

### Improvements

- Move the file chunk merge process to Web Worker to improve performance 将文件区块合并流程转移到 Web Worker 中提高性能

## [0.4.0] - 2024-11-01

### New Features

- Add folder transfer feature 添加文件夹传输功能

### Improvements

- Use Web Worker to compress and uncompress files 使用 Web Worker 压缩和解压缩文件

## [0.3.3] - 2024-10-31

### Bug Fixes

- Fix the bug that the message cannot be scrolled to the bottom when the client is online 修复了当客户端在线时消息无法滚动到底部的问题

### Improvements

- Improve the animation of the message 优化消息的动画

- Improve the date format 优化日期格式

## [0.3.2] - 2024-10-30

### New Features

- Add clipboard history dialog 添加剪贴板历史对话框

## [0.3.1] - 2024-10-29

### Bug Fixes

- Fix the bug that the application cannot be used in a non-secure context 解决了应用在非安全上下文无法使用的问题

## [0.3.0] - 2024-10-28

### New Features

- Add clipboard paste feature 添加剪贴板粘贴功能
