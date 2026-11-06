import { House } from 'lucide-react';
import { ButtonLink, Card } from '@/app/components/ui';

/** Nothing to scan (expired, already scanned, opened by hand) or a share to send again, with a way Home. */
export default function ShareNotice({ title, body, home }: { title: string; body: string; home: string }) {
  return (
    <div style={{ maxWidth: 480, margin: '48px auto' }}>
      <Card as="div" heading="h1" title={title} description={body}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ButtonLink href="/" variant="primary" icon={<House size={18} aria-hidden />}>{home}</ButtonLink>
        </div>
      </Card>
    </div>
  );
}
