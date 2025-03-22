// src/cron/initAdmin.js
const { connectToDatabase } = require('../config/database');
const bcrypt = require('bcryptjs');

(async () => {
  try {
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');

    const adminExists = await usersCollection.findOne({ username: 'admin' });
    if (adminExists) {
      console.log('L’utilisateur admin existe déjà.');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash('your_admin_password', 10); // Remplacez 'your_admin_password' par un mot de passe sécurisé.
    const adminUser = {
      username: 'admin',
      password: hashedPassword,
      role: 'admin'
    };

    await usersCollection.insertOne(adminUser);
    console.log('Utilisateur admin créé avec succès.');
    process.exit(0);
  } catch (error) {
    console.error('Erreur lors de la création de l’utilisateur admin :', error);
    process.exit(1);
  }
})();
