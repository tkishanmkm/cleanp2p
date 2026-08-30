
"use client";

import Link from "next/link";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function ForgotPasswordForm() {
    return (
        <Alert>
            <AlertTitle>Password Recovery</AlertTitle>
            <AlertDescription>
                <p>For security reasons, password recovery must be handled by our support team.</p>
                <p className="mt-2">Please <Link href="/contact" className="font-semibold underline">contact support</Link> and provide your User ID to initiate the recovery process.</p>
            </AlertDescription>
        </Alert>
    );
}
