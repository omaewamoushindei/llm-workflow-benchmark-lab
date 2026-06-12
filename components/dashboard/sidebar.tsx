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
  { name: "Single Case Execution", icon: ClipboardList, href: "/" },
  { name: "Evaluation Setup", icon: Settings2, href: "/evaluation-setup" },
  { name: "Benchmark Results", icon: BarChart3, href: "/benchmark-results" },
  { name: "Reports", icon: FileText, href: "/reports" },
]

interface SidebarProps {
  activePage?: string
}

export function Sidebar({ activePage = "Single Case Execution" }: SidebarProps) {
  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-semibold text-sm text-foreground">LLM Workflow</h1>
            <p className="text-xs text-muted-foreground">Benchmark Lab</p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {menuItems.map((item) => {
            const isActive = item.name === activePage
            return (
              <li key={item.name}>
                <a
                  href={item.href}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  {item.name}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
      
      <div className="p-3 border-t border-border">
        <div className="space-y-2 rounded-lg bg-muted px-3 py-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Example workspace</p>
            <p className="text-xs text-foreground">PCT-guided antibiotic stewardship</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Disclaimer</p>
            <p className="text-xs text-foreground">Prototype benchmark platform. Not for clinical use.</p>
          </div>
          <p className="text-xs font-medium text-muted-foreground">Version</p>
          <p className="text-sm text-foreground">1.0.0-beta</p>
        </div>
      </div>
    </aside>
  )
}
