# YARLE Web Converter Prototype

This directory contains a browser-only prototype for converting Evernote ENEX
exports to Markdown without uploading notes to a server.

## Run locally

From the repository root:

```sh
python3 -m http.server 8080 --directory src/web
```

Open `http://localhost:8080`, select one or more `.enex` files, and click
**Convert**.

## Current scope

- Reads ENEX files with the browser `File` API.
- Parses notes, titles, created/updated dates, tags, and source URLs.
- Converts common ENML/HTML tags to Markdown.
- Supports Standard Markdown and Obsidian-friendly attachment placeholders.
- Copies combined Markdown, downloads Markdown files, or saves to a directory
  when the browser supports the File System Access API.

## Limitations

This is an initial web MVP and does not yet match the CLI/Electron converter:

- Attachments are emitted as Markdown placeholders instead of being extracted.
- Advanced YARLE templates are not implemented.
- Task output formats and application-specific dialects are limited.
- Very large ENEX exports may need streaming parsing in a future iteration.

Use the desktop app or CLI for full-fidelity exports until the web converter
reaches feature parity.
