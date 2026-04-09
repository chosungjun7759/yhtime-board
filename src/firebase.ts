import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyDjgl-NrWo5yuNpl3NC1ogWH1bHMfVEBLU",
  authDomain: "yhtime-a0e18.firebaseapp.com",
  databaseURL: "https://yhtime-a0e18-default-rtdb.firebaseio.com",
  projectId: "yhtime-a0e18",
  storageBucket: "yhtime-a0e18.firebasestorage.app",
  messagingSenderId: "834808856733",
  appId: "1:834808856733:web:a286416ce160ed5c509474"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
