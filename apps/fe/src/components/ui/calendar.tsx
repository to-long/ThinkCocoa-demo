import { ChevronLeft, ChevronRight } from 'lucide-react';
import type * as React from 'react';
import { DayPicker } from 'react-day-picker';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-2', className)}
      classNames={{
        root: 'relative',
        months: 'flex flex-col sm:flex-row gap-3',
        month: 'flex flex-col gap-2',
        month_caption: 'flex justify-center relative items-center h-7',
        caption_label: 'text-xs font-medium',
        nav: 'pointer-events-none absolute inset-x-1 top-2 z-10 flex items-center justify-between',
        button_previous: cn(
          buttonVariants({ variant: 'outline' }),
          'size-6 cursor-pointer bg-transparent p-0 opacity-60 hover:opacity-100 pointer-events-auto',
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline' }),
          'size-6 cursor-pointer bg-transparent p-0 opacity-60 hover:opacity-100 pointer-events-auto',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-7 font-normal text-[0.7rem]',
        week: 'flex w-full mt-0.5',
        day: 'relative p-0 text-center text-xs focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md',
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'size-7 cursor-pointer p-0 font-normal text-xs hover:bg-primary hover:text-primary-foreground aria-selected:opacity-100',
        ),
        range_start: 'day-range-start rounded-l-md bg-primary text-primary-foreground',
        range_end: 'day-range-end rounded-r-md bg-primary text-primary-foreground',
        range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground rounded-none',
        selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        today: 'bg-accent text-accent-foreground',
        outside:
          'day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-4" {...rest} />
          ) : (
            <ChevronRight className="size-4" {...rest} />
          ),
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar };
