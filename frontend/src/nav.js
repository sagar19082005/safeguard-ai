import { LayoutDashboard, Video, BellRing, ShieldAlert, Users, Camera, MapPin, ListChecks, Hexagon, FileBarChart, Settings, ScanSearch, Activity } from "lucide-react";

export const NAV = [
  { group: "Monitoring", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/detection", label: "PPE detection", icon: ScanSearch, phase: 2, desc: "Analyze images with a configured PPE-trained YOLO model." },
    { to: "/live", label: "Live monitoring", icon: Video, phase: 4, desc: "Live camera feeds with detection overlays, person counts and compliance status." },
    { to: "/alerts", label: "Alerts", icon: BellRing, phase: 6, desc: "Acknowledge, assign, comment on and resolve alerts, with escalation for critical ones." },
    { to: "/violations", label: "Violations", icon: ShieldAlert, phase: 5, desc: "Violation history with evidence images, filters and review status." },
  ]},
  { group: "Configuration", items: [
    { to: "/workers", label: "Workers", icon: Users, phase: 7, desc: "Worker records, roles, and individual violation history." },
    { to: "/cameras", label: "Cameras", icon: Camera, phase: 3, desc: "Connect phones, laptop webcams and IP cameras, or upload a video." },
    { to: "/locations", label: "Locations", icon: MapPin, phase: 7, desc: "Sites and workplace zones that cameras are assigned to." },
    { to: "/rules", label: "Safety rules", icon: ListChecks, phase: 5, desc: "Required and optional PPE for each location." },
    { to: "/zones", label: "Restricted zones", icon: Hexagon, phase: 7, desc: "Draw restricted areas on a camera frame and set zone alerts." },
  ]},
  { group: "Insights", items: [
    { to: "/reports", label: "Reports", icon: FileBarChart, phase: 8, desc: "Daily, weekly and monthly safety reports, exported as PDF or CSV." },
    { to: "/analytics", label: "Advanced analytics", icon: Activity, phase: 13, desc: "Compliance patterns, safety heatmap, repeated violations, predictive estimates and camera health." },
    { to: "/settings", label: "Settings", icon: Settings, phase: 6, desc: "Notification channels, alert severity, retention and users." },
  ]},
];
