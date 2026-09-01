'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, Download, Upload, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

const TABLES_TO_BACKUP = [
  'profiles',
  'p2p_ads',
  'trades',
  'support_tickets',
  'deposits',
  'withdrawals',
  'transfers',
  'crypto_deposit_addresses',
  'app_config',
];

export default function DataManagementPage() {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    toast({ title: 'Starting Export', description: 'Fetching all tables... This may take a moment.' });

    const allData: Record<string, any[]> = {};

    try {
      for (const tableName of TABLES_TO_BACKUP) {
        try {
          const { data, error } = await supabase.from(tableName).select('*');
          if (!error && data) {
            allData[tableName] = data;
          }
        } catch (err) {
          console.warn(`Could not export table ${tableName}:`, err);
        }
      }

      const jsonString = JSON.stringify(allData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tradeflow-backup-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: 'Export Complete', description: 'Your data has been downloaded.' });
    } catch (error: any) {
      console.error('Export failed:', error);
      toast({ variant: 'destructive', title: 'Export Failed', description: error.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setFileContent(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const handleImport = async () => {
    if (!fileContent) {
      toast({ variant: 'destructive', title: 'No file content to import' });
      return;
    }
    setIsImporting(true);
    toast({ title: 'Starting Import', description: 'This is a destructive action. Please be patient.' });

    try {
      const dataToImport = JSON.parse(fileContent);

      for (const tableName of Object.keys(dataToImport)) {
        const documents = dataToImport[tableName] as Record<string, any>[];
        if (!Array.isArray(documents) || documents.length === 0) continue;

        try {
          const { error } = await supabase.from(tableName).upsert(documents, { onConflict: 'id' });
          if (error) {
            console.warn(`Upsert error for table ${tableName}:`, error.message);
          }
        } catch (tableErr) {
          console.warn(`Table import error ${tableName}:`, tableErr);
        }
      }
      toast({ title: 'Import Complete', description: 'All data has been restored from the file.' });
    } catch (error: any) {
      console.error('Import failed:', error);
      toast({ variant: 'destructive', title: 'Import Failed', description: `An error occurred: ${error.message}` });
    } finally {
      setIsImporting(false);
      setUploadFile(null);
      setFileContent(null);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Data Management</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Export Data</CardTitle>
          <CardDescription>Download a full JSON backup of all major tables in your database.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download All Data
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle>Import Data</CardTitle>
          <CardDescription className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <div>
              <span className="font-bold">Warning:</span> This is a destructive action. Uploading a file will update or
              overwrite existing records.
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="import-file">Backup JSON File</Label>
            <Input id="import-file" type="file" accept="application/json" onChange={handleFileChange} />
          </div>
        </CardContent>
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={!uploadFile || isImporting}>
                {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload and Restore
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will update your database with the data from the file{' '}
                  <span className="font-mono bg-muted p-1 rounded-sm">{uploadFile?.name}</span>.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleImport} className="bg-destructive hover:bg-destructive/90">
                  Yes, Overwrite My Data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>
    </div>
  );
}
