(function () {
  const state = {
    files: [],
    convertedNotes: [],
  };

  const enexFiles = document.getElementById('enexFiles');
  const fileList = document.getElementById('fileList');
  const convertButton = document.getElementById('convertButton');
  const copyButton = document.getElementById('copyButton');
  const downloadButton = document.getElementById('downloadButton');
  const saveDirectoryButton = document.getElementById('saveDirectoryButton');
  const logOutput = document.getElementById('logOutput');
  const preview = document.getElementById('preview');
  const targetDialect = document.getElementById('targetDialect');
  const metadataMode = document.getElementById('metadataMode');
  const skipWebClips = document.getElementById('skipWebClips');
  const includeTags = document.getElementById('includeTags');

  enexFiles.addEventListener('change', () => {
    state.files = Array.from(enexFiles.files || []);
    renderFiles();
    log(state.files.length ? 'Ready to convert.' : 'Waiting for files...');
  });

  convertButton.addEventListener('click', async () => {
    if (!state.files.length) {
      log('Select at least one ENEX file first.');
      return;
    }

    setBusy(true);
    state.convertedNotes = [];
    const messages = [];

    for (const file of state.files) {
      try {
        const text = await file.text();
        const result = convertEnex(text, {
          fileName: file.name,
          dialect: targetDialect.value,
          metadataMode: metadataMode.value,
          skipWebClips: skipWebClips.checked,
          includeTags: includeTags.checked,
        });
        state.convertedNotes.push(...result.notes);
        messages.push(`${file.name}: ${result.notes.length} converted, ${result.skipped} skipped`);
      } catch (error) {
        messages.push(`${file.name}: failed - ${error.message}`);
      }
    }

    setBusy(false);
    updateActionState();
    renderPreview();
    log(messages.join('\n'));
  });

  copyButton.addEventListener('click', async () => {
    const markdown = state.convertedNotes.map((note) => note.markdown).join('\n\n---\n\n');
    await navigator.clipboard.writeText(markdown);
    log(`Copied ${state.convertedNotes.length} note(s) to the clipboard.`);
  });

  downloadButton.addEventListener('click', () => {
    for (const note of state.convertedNotes) {
      downloadText(note.fileName, note.markdown);
    }
    log(`Started ${state.convertedNotes.length} Markdown download(s).`);
  });

  saveDirectoryButton.addEventListener('click', async () => {
    if (!('showDirectoryPicker' in window)) {
      log('Directory saving is not available in this browser. Use downloads instead.');
      return;
    }

    const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
    for (const note of state.convertedNotes) {
      const handle = await directory.getFileHandle(note.fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(note.markdown);
      await writable.close();
    }
    log(`Saved ${state.convertedNotes.length} note(s) to the selected directory.`);
  });

  function convertEnex(source, options) {
    const xmlText = source.replace(/<!DOCTYPE[\s\S]*?>/g, '');
    const parser = new DOMParser();
    const documentXml = parser.parseFromString(xmlText, 'application/xml');
    const parserError = documentXml.querySelector('parsererror');

    if (parserError) {
      throw new Error(parserError.textContent.trim().replace(/\s+/g, ' '));
    }

    const notes = [];
    let skipped = 0;

    for (const noteNode of Array.from(documentXml.querySelectorAll('note'))) {
      const isWebClip = getText(noteNode, 'content-class').includes('evernote.webclip');
      if (options.skipWebClips && isWebClip) {
        skipped += 1;
        continue;
      }

      const title = getText(noteNode, 'title') || 'Untitled';
      const content = getText(noteNode, 'content');
      const tags = Array.from(noteNode.querySelectorAll('tag')).map((tag) => tag.textContent.trim()).filter(Boolean);
      const metadata = {
        title,
        created: formatEvernoteDate(getText(noteNode, 'created')),
        updated: formatEvernoteDate(getText(noteNode, 'updated')),
        sourceUrl: getText(noteNode, 'source-url'),
        tags,
      };
      const markdownBody = htmlToMarkdown(content, options);
      const markdown = buildMarkdown(metadata, markdownBody, options);
      notes.push({
        title,
        fileName: `${sanitizeFileName(title)}.md`,
        markdown,
      });
    }

    return { notes, skipped };
  }

  function buildMarkdown(metadata, markdownBody, options) {
    if (options.metadataMode === 'none') {
      return `# ${metadata.title}\n\n${markdownBody}`.trim();
    }

    const frontMatter = [
      '---',
      `title: "${escapeYaml(metadata.title)}"`,
      metadata.created ? `created: ${metadata.created}` : '',
      metadata.updated ? `updated: ${metadata.updated}` : '',
      metadata.sourceUrl ? `source: "${escapeYaml(metadata.sourceUrl)}"` : '',
      options.includeTags && metadata.tags.length ? `tags: [${metadata.tags.map((tag) => `"${escapeYaml(tag)}"`).join(', ')}]` : '',
      '---',
    ].filter(Boolean).join('\n');

    return `${frontMatter}\n\n# ${metadata.title}\n\n${markdownBody}`.trim();
  }

  function htmlToMarkdown(enmlContent, options) {
    if (!enmlContent.trim()) {
      return '';
    }

    const htmlText = enmlContent
      .replace(/<!DOCTYPE[\s\S]*?>/g, '')
      .replace(/<en-note/g, '<section')
      .replace(/<\/en-note>/g, '</section>');
    const htmlDocument = new DOMParser().parseFromString(htmlText, 'text/html');
    const root = htmlDocument.body;
    const markdown = renderChildren(root, options)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return markdown || root.textContent.trim();
  }

  function renderChildren(node, options) {
    return Array.from(node.childNodes).map((child) => renderNode(child, options)).join('');
  }

  function renderNode(node, options) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, ' ');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tag = node.tagName.toLowerCase();
    const inner = renderChildren(node, options).trim();

    switch (tag) {
      case 'section':
      case 'article':
      case 'main':
      case 'body':
        return `${inner}\n\n`;
      case 'div':
      case 'p':
        return inner ? `${inner}\n\n` : '\n';
      case 'br':
        return '\n';
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return `${'#'.repeat(Number(tag.slice(1)))} ${inner}\n\n`;
      case 'strong':
      case 'b':
        return inner ? `**${inner}**` : '';
      case 'em':
      case 'i':
        return inner ? `_${inner}_` : '';
      case 's':
      case 'strike':
      case 'del':
        return inner ? `~~${inner}~~` : '';
      case 'code':
        return inner ? `\`${inner.replace(/`/g, '\\`')}\`` : '';
      case 'pre':
        return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
      case 'blockquote':
        return `${inner.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
      case 'ul':
        return `${renderList(node, false, options)}\n`;
      case 'ol':
        return `${renderList(node, true, options)}\n`;
      case 'li':
        return inner;
      case 'a': {
        const href = node.getAttribute('href');
        return href ? `[${inner || href}](${href})` : inner;
      }
      case 'img':
      case 'en-media': {
        const title = node.getAttribute('title') || node.getAttribute('alt') || node.getAttribute('hash') || 'attachment';
        return options.dialect === 'obsidian'
          ? `![[${title}]]`
          : `![${title}](${title})`;
      }
      case 'table':
        return `${renderTable(node, options)}\n\n`;
      default:
        return inner;
    }
  }

  function renderList(node, ordered, options) {
    return Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((item, index) => {
        const marker = ordered ? `${index + 1}.` : '-';
        const content = renderChildren(item, options).trim().replace(/\n/g, '\n  ');
        return `${marker} ${content}`;
      })
      .join('\n');
  }

  function renderTable(node, options) {
    const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
      Array.from(row.children).map((cell) => renderChildren(cell, options).trim().replace(/\|/g, '\\|'))
    );

    if (!rows.length) {
      return '';
    }

    const width = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ''));
    const header = normalizedRows[0];
    const separator = Array.from({ length: width }, () => '---');
    const body = normalizedRows.slice(1);

    return [header, separator, ...body]
      .map((row) => `| ${row.join(' | ')} |`)
      .join('\n');
  }

  function getText(node, selector) {
    const found = node.querySelector(selector);
    return found && found.textContent ? found.textContent.trim() : '';
  }

  function formatEvernoteDate(value) {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
    if (!match) {
      return '';
    }
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  function sanitizeFileName(value) {
    const sanitized = value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return sanitized || 'Untitled';
  }

  function escapeYaml(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function downloadText(fileName, text) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderFiles() {
    if (!state.files.length) {
      fileList.textContent = 'No files selected.';
      return;
    }

    fileList.innerHTML = state.files.map((file) => `
      <div class="file-row">
        <span>${escapeHtml(file.name)}</span>
        <span>${formatBytes(file.size)}</span>
      </div>
    `).join('');
  }

  function renderPreview() {
    if (!state.convertedNotes.length) {
      preview.className = 'preview empty';
      preview.textContent = 'No notes converted.';
      return;
    }

    preview.className = 'preview';
    preview.innerHTML = state.convertedNotes.slice(0, 10).map((note) => `
      <article class="note-card">
        <h3>${escapeHtml(note.title)}</h3>
        <p>${escapeHtml(note.markdown.slice(0, 240))}${note.markdown.length > 240 ? '...' : ''}</p>
      </article>
    `).join('');
  }

  function updateActionState() {
    const hasOutput = state.convertedNotes.length > 0;
    copyButton.disabled = !hasOutput;
    downloadButton.disabled = !hasOutput;
    saveDirectoryButton.disabled = !hasOutput || !('showDirectoryPicker' in window);
  }

  function setBusy(isBusy) {
    convertButton.disabled = isBusy;
    convertButton.textContent = isBusy ? 'Converting...' : 'Convert';
  }

  function log(message) {
    logOutput.textContent = message;
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  function formatBytes(value) {
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  renderFiles();
  updateActionState();
})();
