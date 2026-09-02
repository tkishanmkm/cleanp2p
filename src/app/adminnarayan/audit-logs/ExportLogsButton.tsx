"use client";

import { useState } from "react";
import { exportAuditLogsAction } from "./actions";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileCode, Loader2 } from "lucide-react";

export function ExportLogsButton() {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: "csv" | "json") => {
    setIsExporting(true);
    try {
      const res = await exportAuditLogsAction(format);
      if (!res.success || !res.data) {
        alert(`Export failed: ${res.error}`);
        return;
      }

      // Trigger direct browser download
      const blob = new Blob([res.data], { type: res.contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = res.filename!;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Error exporting logs: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={isExporting}
        onClick={() => handleExport("csv")}
        className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
      >
        {isExporting ? (
          <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
        ) : (
          <FileSpreadsheet className="w-4 h-4 text-emerald-400 mr-1.5" />
        )}
        Export CSV
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={isExporting}
        onClick={() => handleExport("json")}
        className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
      >
        {isExporting ? (
          <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
        ) : (
          <FileCode className="w-4 h-4 text-indigo-400 mr-1.5" />
        )}
        Export JSON
      </Button>
    </div>
  );
}
