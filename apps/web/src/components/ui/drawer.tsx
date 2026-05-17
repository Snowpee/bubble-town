import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { cn } from '@/lib/utils';

const Drawer = ({
  shouldScaleBackground = false,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
);

const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerPortal = DrawerPrimitive.Portal;
const DrawerClose = DrawerPrimitive.Close;
const DrawerOverlay = DrawerPrimitive.Overlay;

type DrawerDirection = NonNullable<React.ComponentProps<typeof DrawerPrimitive.Root>['direction']>;

interface DrawerContentProps extends React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> {
  direction?: DrawerDirection;
  portal?: boolean;
  overlay?: boolean;
  overlayClassName?: string;
  overlayStyle?: React.CSSProperties;
}

const directionClasses: Record<DrawerDirection, string> = {
  top: 'inset-x-0 top-0 border-b',
  bottom: 'inset-x-0 bottom-0 border-t',
  left: 'inset-y-0 left-0 h-full border-r',
  right: 'inset-y-0 right-0 h-full border-l',
};

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  DrawerContentProps
>(({ direction = 'bottom', portal = true, overlay = true, overlayClassName, overlayStyle, className, children, ...props }, ref) => {
  const content = (
    <>
      {overlay ? (
        <DrawerOverlay
          style={overlayStyle}
          className={cn(
            portal ? 'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm' : 'absolute inset-0 z-10 bg-background/60 backdrop-blur-[2px]',
            overlayClassName,
          )}
        />
      ) : null}
      <DrawerPrimitive.Content
        ref={ref}
        className={cn(
          'flex flex-col bg-card shadow-2xl outline-hidden',
          portal ? 'fixed z-50' : 'absolute z-20',
          directionClasses[direction],
          className,
        )}
        {...props}
      >
        {children}
      </DrawerPrimitive.Content>
    </>
  );

  return portal ? <DrawerPortal>{content}</DrawerPortal> : content;
});
DrawerContent.displayName = 'DrawerContent';

function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-2 text-left', className)} {...props} />;
}

function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

function DrawerTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold tracking-tight', className)} {...props} />;
}

function DrawerDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerClose,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
