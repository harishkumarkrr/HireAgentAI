export interface Form {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  questions: string[];
  language: string;
  voice: string;
  createdAt: any;
  updatedAt?: any;
  deleted?: boolean;
}

export interface FormResponse {
  id: string;
  formId: string;
  respondentName: string;
  respondentEmail: string;
  answers: Record<string, string>;
  transcript: TranscriptEntry[];
  status: 'started' | 'completed';
  createdAt: any;
  updatedAt?: any;
  deleted?: boolean;
}

export interface TranscriptEntry {
  role: 'agent' | 'user';
  text: string;
  timestamp: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}
