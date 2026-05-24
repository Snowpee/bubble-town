import type { HealthCheckItem } from '@bubble-town/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface StatusCardProps {
  item: HealthCheckItem;
}

export function StatusCard({ item }: StatusCardProps) {
  return (
    <Card className="rounded-[var(--settings-surface-radius,1.75rem)] border-border/70 bg-card/78 shadow-[0_20px_48px_-28px_var(--companion-glass-shadow)] backdrop-blur-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle>{item.key}</CardTitle>
          <Badge variant={item.status === 'ok' ? 'default' : 'secondary'}>{item.status}</Badge>
        </div>
        <CardDescription>{item.message}</CardDescription>
      </CardHeader>
      {item.detail ? <CardContent className="text-xs text-muted-foreground">{item.detail}</CardContent> : null}
    </Card>
  );
}
