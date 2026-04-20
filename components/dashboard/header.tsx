"use client"

import { Bell, HelpCircle, User } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Header() {
  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Clinical Case Input</h2>
        <p className="text-sm text-muted-foreground">Enter patient data for PCT-guided evaluation</p>
      </div>
      
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <HelpCircle className="w-5 h-5" />
          <span className="sr-only">Help</span>
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <Bell className="w-5 h-5" />
          <span className="sr-only">Notifications</span>
        </Button>
        <div className="w-px h-6 bg-border mx-2" />
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-medium">Clinician</span>
        </Button>
      </div>
    </header>
  )
}
