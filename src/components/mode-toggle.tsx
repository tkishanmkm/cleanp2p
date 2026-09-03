"use client";

import * as React from "react";
import { Moon, Sun, Laptop } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ModeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/60 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 transition-all shadow-xs flex items-center justify-center relative cursor-pointer"
          title="Toggle theme"
        >
          <Sun className="h-4 w-4 text-amber-500 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 text-indigo-400 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 rounded-xl p-1 shadow-lg">
        <DropdownMenuItem onClick={() => setTheme("light")} className="flex items-center gap-2 py-2 cursor-pointer rounded-lg">
          <Sun className="h-4 w-4 text-amber-500" />
          <span className="font-medium text-xs">Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")} className="flex items-center gap-2 py-2 cursor-pointer rounded-lg">
          <Moon className="h-4 w-4 text-indigo-400" />
          <span className="font-medium text-xs">Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")} className="flex items-center gap-2 py-2 cursor-pointer rounded-lg">
          <Laptop className="h-4 w-4 text-slate-500" />
          <span className="font-medium text-xs">System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
