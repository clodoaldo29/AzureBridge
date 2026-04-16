import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { prisma } from '@/database/client';
import { User } from '@prisma/client';

// ============================================
// TIPOS
// ============================================

interface MicrosoftTokenClaims {
    oid: string;           // Object ID — identificador único do usuário no Azure AD
    preferred_username: string; // Email corporativo
    name: string;          // Nome de exibição
    tid: string;           // Tenant ID
    aud: string;           // Audience (deve ser o Client ID do app)
    iss: string;           // Issuer
    exp: number;
    iat: number;
}

export interface AppTokenPayload {
    sub: string;           // User.id (UUID)
    email: string;
    displayName: string;
    iat?: number;
    exp?: number;
}

// ============================================
// CLIENTE JWKS (com cache de 10 min)
// ============================================

function getJwksClient() {
    const tenantId = process.env.AZURE_AD_TENANT_ID;
    if (!tenantId) {
        throw new Error('AZURE_AD_TENANT_ID não configurado');
    }

    return jwksClient({
        jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 10 * 60 * 1000, // 10 minutos
        rateLimit: true,
        jwksRequestsPerMinute: 10,
    });
}

// ============================================
// VERIFICAR TOKEN MICROSOFT
// ============================================

export async function verifyMicrosoftToken(idToken: string): Promise<MicrosoftTokenClaims> {
    const tenantId = process.env.AZURE_AD_TENANT_ID;
    const clientId = process.env.AZURE_AD_CLIENT_ID;

    if (!tenantId || !clientId) {
        throw new Error('Configuração de SSO incompleta: AZURE_AD_TENANT_ID e AZURE_AD_CLIENT_ID são obrigatórios');
    }

    const client = getJwksClient();

    return new Promise((resolve, reject) => {
        jwt.verify(
            idToken,
            (header, callback) => {
                client.getSigningKey(header.kid, (err, key) => {
                    if (err) return callback(err);
                    callback(null, key?.getPublicKey());
                });
            },
            {
                algorithms: ['RS256'],
                audience: clientId,
                issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
            },
            (err, decoded) => {
                if (err) return reject(new Error(`Token Microsoft inválido: ${err.message}`));

                const claims = decoded as MicrosoftTokenClaims;

                // Validação extra: garantir que o tid pertence ao tenant iRede
                if (claims.tid !== tenantId) {
                    return reject(new Error('Token pertence a um tenant não autorizado'));
                }

                resolve(claims);
            }
        );
    });
}

// ============================================
// UPSERT DO USUÁRIO NO BANCO
// ============================================

export async function upsertUser(claims: MicrosoftTokenClaims): Promise<User> {
    const email = claims.preferred_username || (claims as unknown as Record<string, string>)['email'] || '';

    return prisma.user.upsert({
        where: { azureId: claims.oid },
        update: {
            email,
            displayName: claims.name,
        },
        create: {
            azureId: claims.oid,
            email,
            displayName: claims.name,
        },
    });
}

// ============================================
// EMITIR JWT PRÓPRIO
// ============================================

export function issueAppToken(user: User): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET não configurado');
    }

    const payload: AppTokenPayload = {
        sub: user.id,
        email: user.email,
        displayName: user.displayName,
    };

    return jwt.sign(payload, secret, {
        expiresIn: '8h',
        algorithm: 'HS256',
    });
}
