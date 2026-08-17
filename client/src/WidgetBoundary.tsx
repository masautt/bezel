import { Component } from 'react'
import type { ReactNode } from 'react'

interface Props { name: string; children: ReactNode }
interface State { failed: boolean }

// A widget that throws must never take the terminals down with it.
export class WidgetBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return <div className="widget widget-failed">{this.props.name} unavailable</div>
    return this.props.children
  }
}
