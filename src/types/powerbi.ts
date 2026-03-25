// TypeScript interfaces for PowerBI types

export interface PowerBIReport {
    id: string;
    name: string;
    embedUrl: string;
    webUrl: string;
}

export interface PowerBIDashboard {
    id: string;
    name: string;
    embedUrl: string;
    webUrl: string;
}

export interface PowerBIEmbeddedConfig {
    reportId: string;
    accessToken: string;
    embedUrl: string;
    dashboardId?: string;
}