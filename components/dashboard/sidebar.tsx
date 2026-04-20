"use client"

import { cn } from "@/lib/utils"
import {
  ClipboardList,
  Settings2,
  BarChart3,
  FileText,
  Activity,
} from "lucide-react"

const menuItems = [
  { name: "Case Input", icon: ClipboardList, active: true },
  { name: "Evaluation Setup", icon: Settings2, active: false },
  { name: "Benchmark Results", icon: BarChart3, active: false },
  { name: "Reports", icon: FileText, active: false },
]

export function Sidebar() {
  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-semibold text-sm text-foreground">PCT Stewardship</h1>
            <p className="text-xs text-muted-foreground">Evaluator</p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {menuItems.map((item) => (
            <li key={item.name}>
              <button
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  item.active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      
      <div className="p-3 border-t border-border">
        <div className="px-3 py-2 rounded-lg bg-muted">
          <p className="text-xs font-medium text-muted-foreground">Version</p>
          <p className="text-sm text-foreground">1.0.0-beta</p>
        </div>
      </div>
    </aside>
  )
}
