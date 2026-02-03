'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Megaphone,
  Calendar,
  Trophy,
  MessageSquare,
  Settings,
} from 'lucide-react';
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from '@/components/ui/sidebar';
import { NavItem } from '@/lib/types';
import { cn } from '@/lib/utils';

const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: <LayoutDashboard />,
  },
  {
    title: 'AI Shoutouts',
    href: '/shoutouts',
    icon: <Megaphone />,
  },
  {
    title: 'Calendar',
    href: '/calendar',
    icon: <Calendar />,
  },
  {
    title: 'Leaderboard',
    href: '/leaderboard',
    icon: <Trophy />,
  },
  {
    title: 'Messages',
    href: '/forwarding',
    icon: <MessageSquare />,
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: <Settings />,
  },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav>
      <SidebarMenu>
        {navItems.map((item) => (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith(item.href)}
              className={cn(
                'w-full gap-2 group-data-[collapsed=false]:justify-start group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-2',
                pathname.startsWith(item.href) &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
              )}
              tooltip={item.title}
            >
              <Link href={item.href}>
                {item.icon}
                <span className="truncate group-data-[collapsed=true]:hidden">
                  {item.title}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </nav>
  );
}
