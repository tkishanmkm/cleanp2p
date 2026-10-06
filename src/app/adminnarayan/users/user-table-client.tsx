"use client";

import { useState } from "react";
import Link from "next/link";
import { UserRoleToggle } from "./user-role-toggle";
import { UserSuspendToggle } from "./user-suspend-toggle";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function UserTableClient({ initialProfiles }: { initialProfiles: any[] }) {
  const [search, setSearch] = useState("");

  const filteredProfiles = initialProfiles.filter(
    (p) =>
      p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.user_id?.toLowerCase().includes(search.toLowerCase()) ||
      p.id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search users by name or ID..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User ID / Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProfiles.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="font-medium">{user.full_name || "N/A"}</div>
                  <div className="text-xs text-muted-foreground font-mono">{user.id}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={user.role === "admin" ? "default" : "outline"}>
                      {user.role || "user"}
                    </Badge>
                    <UserRoleToggle userId={user.id} currentRole={user.role || "user"} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {user.is_banned ? (
                      <Badge variant="destructive">Suspended</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                    <UserSuspendToggle userId={user.id} isSuspended={!!user.is_banned} />
                  </div>
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Link href={`/adminnarayan/users/${user.id}`}>
                    <Button size="sm" variant="outline">
                      View Details
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
