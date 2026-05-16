import type { HealthCheckItem } from '@bubble-town/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface StatusCardProps {
  item: HealthCheckItem;
}

export function StatusCard({ item }: StatusCardProps) {
  return (
    <Card>
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
