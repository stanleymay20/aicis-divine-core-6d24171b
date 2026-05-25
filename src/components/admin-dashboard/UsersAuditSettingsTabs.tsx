import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle } from "lucide-react";

export function UsersTab({ userRoles }: { userRoles: any[] | undefined }) {
  return (
    <Card>
      <CardHeader><CardTitle>User Roles</CardTitle><CardDescription>Manage user permissions and access levels</CardDescription></CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {userRoles?.length === 0 && <p className="text-muted-foreground text-center py-8">No user roles configured</p>}
            {userRoles?.map((role: any) => (
              <div key={role.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">{role.user_id}</p>
                  <p className="text-sm text-muted-foreground">Created: {new Date(role.created_at).toLocaleDateString()}</p>
                </div>
                <Badge>{role.role}</Badge>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function AuditTab({ auditLogs }: { auditLogs: any[] | undefined }) {
  return (
    <Card>
      <CardHeader><CardTitle>Audit Trail</CardTitle><CardDescription>Complete log of system actions and events</CardDescription></CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px]">
          <div className="space-y-2">
            {auditLogs?.length === 0 && <p className="text-muted-foreground text-center py-8">No audit logs available</p>}
            {auditLogs?.map((log: any) => (
              <div key={log.id} className="flex items-start gap-3 p-3 border rounded-lg">
                <div className={`p-2 rounded-full ${log.severity === "error" ? "bg-destructive/20" : log.severity === "warn" ? "bg-warning/20" : "bg-primary/20"}`}>
                  {log.severity === "error" ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle className="h-4 w-4 text-primary" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{log.action}</p>
                    <span className="text-xs text-muted-foreground font-mono">{new Date(log.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{log.resource_type}: {log.resource_id}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function SettingsTab() {
  return (
    <Card>
      <CardHeader><CardTitle>System Configuration</CardTitle><CardDescription>Configure AICIS platform settings</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Platform Mode</p>
            <div className="flex gap-2"><Badge variant="default">Production</Badge><Badge variant="outline">Enterprise</Badge></div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Data Retention</p>
            <p className="text-sm text-muted-foreground">90 days for operational data, 7 years for compliance</p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Federation Status</p>
            <Badge variant="secondary">Enabled</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
