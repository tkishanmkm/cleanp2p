import { cn } from "@/lib/utils";

export function DefaultAvatar({ className }: { className?: string }) {
    return (
        <svg
            className={cn("h-full w-full", className)}
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <circle cx="50" cy="50" r="50" fill="#C4C4C4" />
            <path
                d="M50 45C56.6274 45 62 39.6274 62 33C62 26.3726 56.6274 21 50 21C43.3726 21 38 26.3726 38 33C38 39.6274 43.3726 45 50 45Z"
                fill="white"
            />
            <path
                d="M75 79C75 68.5228 63.8071 60 50 60C36.1929 60 25 68.5228 25 79H75Z"
                fill="white"
            />
        </svg>
    );
}
