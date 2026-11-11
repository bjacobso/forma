---
"@forma-language/forma": minor
---

**Breaking:** Prepare the initial single-package Forma distribution, with a curated root, explicit advanced subpaths, optional React peers and both executables. The four implementation workspaces are private. Migrate old engine imports to `@forma-language/forma` subpaths (`editor` becomes `editor-services`), host imports to `/host`, and UI imports to `/editor/codemirror` or `/editor/react`. Install the required Effect peer; 4.1.1 is the tested baseline. Pending implementation release notes now apply to this distribution and retain their original breaking notes.
