import { createRoot } from 'react-dom/client'
import '@devkit-inc/react-ui/appbar.css'
import '@devkit-inc/react-ui/scroll.css'
// NOT react-ui/console.css, though it publishes the same `--ansi-*` names the
// terminal panes paint with. The theme registry writes those tokens to <html>'s
// INLINE style (ANSI_TOKENS is part of ALL_TOKENS), which outranks any
// stylesheet — so console.css could only ever apply before the registry
// resolves, and it gates its dark half on a `.dark` class rather than on the
// active theme. Importing it would add a second, differently-keyed source of
// truth that wins in exactly one frame. terminalTheme.ts carries an explicit
// dark fallback for that frame instead.
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
