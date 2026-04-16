import { Configuration, PublicClientApplication, RedirectRequest } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_AD_CLIENT_ID as string;
const tenantId = import.meta.env.VITE_AZURE_AD_TENANT_ID as string;

export const msalConfig: Configuration = {
    auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin,

    },
    cache: {
        cacheLocation: 'sessionStorage',
    },
};

export const loginRequest: RedirectRequest = {
    scopes: ['openid', 'profile', 'email'],
};

export const msalInstance = new PublicClientApplication(msalConfig);
