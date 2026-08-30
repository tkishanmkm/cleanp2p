
"use client";

import { useState, useRef, useEffect } from 'react';
import { useFirebase } from '@/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import type { User } from '@/lib/types';

export function ProfileSettings({ user }: { user: User }) {
    const { auth, firestore } = useFirebase();
    const { toast } = useToast();
    const [previewUrl, setPreviewUrl] = useState<string | null>(user?.photoURL || null);
    const [fileToUpload, setFileToUpload] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!fileToUpload) {
            setPreviewUrl(user?.photoURL || null);
        }
    }, [user?.photoURL, fileToUpload]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) {
                toast({
                    variant: "destructive",
                    title: "File too large",
                    description: "Max file size is 2MB.",
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
        if (!user?.id || !auth?.currentUser || !firestore) {
            toast({ variant: 'destructive', title: 'Error', description: 'User not authenticated or Firebase services not available.' });
            return;
        }

        setIsUploading(true);
        const currentUserId = user.id;

        try {
            const photoURL = previewUrl; // The previewUrl is the Base64 data URL

            if (!photoURL) {
                throw new Error("No image data available to save.");
            }

            // Update Firestore user document
            const userDocRef = doc(firestore, 'users', currentUserId);
            await updateDoc(userDocRef, { photoURL });

            setFileToUpload(null); // Clear the file state after successful upload

            toast({ title: 'Profile Updated', description: 'Your new profile picture has been saved.' });
        } catch (error: any) {
            console.error("Error updating profile picture:", error);
            setPreviewUrl(user?.photoURL || null);
            toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle>Profile Picture</CardTitle>
                <CardDescription>Update your avatar. This is how other users will see you.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6 text-center">
                 <Avatar className="h-32 w-32 border-4 border-secondary shadow-md">
                    <AvatarImage src={previewUrl || ''} alt="User Avatar" />
                    <AvatarFallback className="bg-white border text-muted-foreground text-4xl font-light">
                        {user?.userId?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                </Avatar>
                <div className="text-sm text-muted-foreground">
                    For best results, upload a square image (e.g., 200x200 pixels). Max file size: 2MB.
                </div>
            </CardContent>
            <CardFooter className="border-t px-6 py-4 flex-col sm:flex-row gap-4 justify-between items-center">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/png, image/jpeg, image/gif" />
                <Button variant="outline" onClick={handleUploadClick} className="w-full sm:w-auto">
                    <Upload className="mr-2 h-4 w-4" />
                    Choose Picture
                </Button>
                <Button onClick={handleSave} disabled={!fileToUpload || isUploading} className="w-full sm:w-auto">
                    {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isUploading ? 'Saving...' : 'Save Picture'}
                </Button>
            </CardFooter>
        </Card>
    );
}
