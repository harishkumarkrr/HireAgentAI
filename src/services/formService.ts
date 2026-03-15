import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  serverTimestamp,
  onSnapshot
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Form, FormResponse, OperationType, FirestoreErrorInfo } from '../types';

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const formService = {
  async createForm(title: string, description: string, questions: string[], language: string = 'en-US', voice: string = 'Zephyr'): Promise<string> {
    const path = 'forms';
    try {
      if (!auth.currentUser) throw new Error('User not authenticated');
      
      const form: Omit<Form, 'id'> = {
        creatorId: auth.currentUser.uid,
        title,
        description,
        questions,
        language,
        voice,
        createdAt: serverTimestamp(),
        deleted: false
      };
      
      console.log("Creating form with data:", form);
      const docRef = await addDoc(collection(db, path), form);
      console.log("Form created with ID:", docRef.id);
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
      return '';
    }
  },

  async updateForm(id: string, updates: Partial<Form>) {
    const path = `forms/${id}`;
    try {
      const docRef = doc(db, 'forms', id);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deleteForm(id: string) {
    const path = `forms/${id}`;
    try {
      const docRef = doc(db, 'forms', id);
      // In a real app, we might want to delete all associated responses too
      // For now, we'll just delete the form
      await updateDoc(docRef, { deleted: true }); // Soft delete
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async getForm(id: string): Promise<Form | null> {
    const path = `forms/${id}`;
    try {
      const docRef = doc(db, 'forms', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data() as Form;
        if (data.deleted) return null;
        return { id: docSnap.id, ...data } as Form;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  },

  subscribeToUserForms(callback: (forms: Form[]) => void) {
    const path = 'forms';
    try {
      if (!auth.currentUser) return () => {};
      
      const q = query(
        collection(db, path), 
        where('creatorId', '==', auth.currentUser.uid), 
        orderBy('createdAt', 'desc')
      );
      
      return onSnapshot(q, (snapshot) => {
        const forms = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Form))
          .filter(f => !f.deleted);
        callback(forms);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return () => {};
    }
  }
};

export const responseService = {
  async createResponse(formId: string, respondentName: string, respondentEmail: string): Promise<string> {
    const path = 'responses';
    try {
      const response: Omit<FormResponse, 'id'> = {
        formId,
        respondentName,
        respondentEmail,
        answers: {},
        transcript: [],
        status: 'started',
        createdAt: serverTimestamp(),
        deleted: false
      };
      
      const docRef = await addDoc(collection(db, path), response);
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
      return '';
    }
  },

  async getResponse(id: string): Promise<FormResponse | null> {
    const path = `responses/${id}`;
    try {
      const docRef = doc(db, 'responses', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as FormResponse;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
      return null;
    }
  },

  async deleteResponse(id: string) {
    const path = `responses/${id}`;
    try {
      const docRef = doc(db, 'responses', id);
      await updateDoc(docRef, { deleted: true }); // Soft delete
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async updateResponse(id: string, updates: Partial<FormResponse>) {
    const path = `responses/${id}`;
    try {
      const docRef = doc(db, 'responses', id);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  subscribeToFormResponses(formId: string, callback: (responses: FormResponse[]) => void) {
    const path = 'responses';
    try {
      const q = query(
        collection(db, path), 
        where('formId', '==', formId), 
        orderBy('createdAt', 'desc')
      );
      
      return onSnapshot(q, (snapshot) => {
        const responses = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as FormResponse))
          .filter(r => !r.deleted);
        callback(responses);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return () => {};
    }
  }
};
