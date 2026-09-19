'use client';

import { useState, useRef, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, Trash2 } from 'lucide-react';
import type { User } from '@/lib/types';
import { useRouter } from 'next/navigation';

export function ProfileSettings({ user }: { user: User }) {
  const { toast } = useToast();
  const router = useRouter();
  const [previewUrl, setPreviewUrl] = useState<string | null>(user?.photoURL || null);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!fileToUpload) {
      setPreviewUrl(user?.photoURL || null);
    }
  }, [user?.photoURL, fileToUpload]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          variant: 'destructive',
          title: 'File too large',
          description: 'Max file size is 10MB.',
        });
        return;
      }
      setFileToUpload(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleSave = async () => {
    if (!fileToUpload) {
      toast({ variant: 'destructive', title: 'No file selected', description: 'Please choose a picture to upload.' });
      return;
    }
    if (!user?.id) {
      toast({ variant: 'destructive', title: 'Error', description: 'User not authenticated.' });
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', fileToUpload);

      const res = await fetch('/api/user/profile/avatar', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload picture');
      }

      setFileToUpload(null);
      setPreviewUrl(data.avatarUrl || data.avatar_url || previewUrl);
      toast({ title: 'Profile Updated', description: 'Your new profile picture has been saved and synced.' });
      router.refresh();
    } catch (error: any) {
      console.error('Error updating profile picture:', error);
      setPreviewUrl(user?.photoURL || null);
      toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch('/api/user/profile/avatar', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove picture');
      }

      setFileToUpload(null);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast({ title: 'Avatar Removed', description: 'Your profile picture has been removed and synced.' });
      router.refresh();
    } catch (error: any) {
      console.error('Error deleting profile picture:', error);
      toast({ variant: 'destructive', title: 'Delete Failed', description: error.message });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Profile Picture</CardTitle>
        <CardDescription>Update your avatar. This is how other users will see you across the platform.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 text-center">
        <Avatar className="h-32 w-32 border-4 border-secondary shadow-md">
          <AvatarImage src={previewUrl || ''} alt="User Avatar" />
          <AvatarFallback className="bg-white dark:bg-slate-800 border text-muted-foreground text-4xl font-light">
            {user?.displayName?.charAt(0).toUpperCase() || user?.userId?.charAt(0).toUpperCase() || 'U'}
          </AvatarFallback>
        </Avatar>
        <div className="text-sm text-muted-foreground">
          For best results, upload a square image. Supported formats: PNG, JPEG, WebP. Max file size: 10MB.
        </div>
      </CardContent>
      <CardFooter className="border-t px-6 py-4 flex-col sm:flex-row gap-3 justify-between items-center">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="image/png, image/jpeg, image/webp"
        />
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={handleUploadClick} className="flex-1 sm:flex-initial">
            <Upload className="mr-2 h-4 w-4" />
            Choose Picture
          </Button>
          {previewUrl && (
            <Button 
              variant="destructive" 
              onClick={handleDelete} 
              disabled={isDeleting || isUploading}
              className="flex-1 sm:flex-initial bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20"
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Remove
            </Button>
          )}
        </div>
        <Button onClick={handleSave} disabled={!fileToUpload || isUploading} className="w-full sm:w-auto">
          {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isUploading ? 'Saving...' : 'Save Picture'}
        </Button>
      </CardFooter>
    </Card>
  );
}
