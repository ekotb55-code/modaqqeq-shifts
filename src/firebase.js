import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyCRCvSveuol7K9eQdDVTPEFundBVD8HtWs',
  authDomain: 'modaqqeq-shifts.firebaseapp.com',
  projectId: 'modaqqeq-shifts',
  storageBucket: 'modaqqeq-shifts.firebasestorage.app',
  messagingSenderId: '890738231200',
  appId: '1:890738231200:web:1c43da5dbb5c6ad007c6c5',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Offline-first: data is cached on the device and synced when the internet returns.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Modaqqeq super-admin accounts (full access to everything).
export const SUPER_ADMINS = ['ekotb555@gmail.com'];
