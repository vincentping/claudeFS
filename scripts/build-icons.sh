#!/usr/bin/env bash
# 把 src/icons/*.png.b64 解码成真正的 PNG 文件。
# 之所以仓库里存的是 base64 文本而不是二进制 PNG：当前的文档/文件写入工作流走的是
# 文本内容通道，二进制字节没法可靠地原样传输，所以用 base64 作为安全的中间格式。
# 源图（可编辑）在 src/icons/claudefs.svg，如需重新生成 PNG，可以用
# rsvg-convert -w <size> -h <size> src/icons/claudefs.svg -o src/icons/icon<size>.png
# 然后重新 base64 一份存回 .b64 文件（保证仓库里始终有一份文本可追踪的真实来源）。
set -euo pipefail
cd "$(dirname "$0")/../src/icons"

for size in 16 48 128; do
  base64 -d "icon${size}.png.b64" > "icon${size}.png"
  echo "生成 icon${size}.png"
done
