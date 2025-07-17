// // sharedContext.js
// const fs = require('fs');
// const path = require('path');

// const CONTEXT_PATH = path.join(__dirname, 'sharedContext.json');

// // Default in-memory structure
// const sharedContext = {
//   selectedFieldsPerObject: {},
//   availableFieldsPerObject: {},
//   objectList: [],
//   select_modal:'',
  
  

//   // Save current state to disk
//   save() {
//     const dataToSave = {
//       selectedFieldsPerObject: this.selectedFieldsPerObject,
//       availableFieldsPerObject: this.availableFieldsPerObject,
//       objectList: this.objectList,
//       select_modal:this.select_modal
//     };

//     try {
//       fs.writeFileSync(CONTEXT_PATH, JSON.stringify(dataToSave, null, 2));
//       console.log('✅ sharedContext saved to disk.');
//     } catch (err) {
//       console.error('❌ Failed to save sharedContext:', err);
//     }
//   },

//   // Load from disk (if file exists)
//   load() {
//     if (fs.existsSync(CONTEXT_PATH)) {
//       try {
//         const data = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf-8'));
//         this.selectedFieldsPerObject = data.selectedFieldsPerObject || {};
//         this.availableFieldsPerObject = data.availableFieldsPerObject || {};
//         this.objectList = data.objectList || [];
//         this.select_modal=data.select_modal
//         console.log('📥 sharedContext loaded from disk.');
//       } catch (err) {
//         console.error('❌ Failed to load sharedContext:', err);
//       }
//     } else {
//       console.log('ℹ️ No existing sharedContext.json found. Using empty defaults.');
//     }
//   }
// };

// // Immediately try to load when this module is required
// sharedContext.load();

// module.exports = sharedContext;


// sharedContext.js
const fs = require('fs');
const path = require('path');

const CONTEXT_PATH = path.join(__dirname, 'sharedContext.json');

// Default in-memory structure
const sharedContext = {
  selectedFieldsPerObject: {},
  availableFieldsPerObject: {},
  selectedFieldDescriptions: {},   // ✅ Descriptions per object + field
  relationshipDescription: '',     // ✅ Added relationship description
  objectList: [],
  select_modal: '',

  // Save current state to disk
  save() {
    const dataToSave = {
      selectedFieldsPerObject: this.selectedFieldsPerObject,
      availableFieldsPerObject: this.availableFieldsPerObject,
      selectedFieldDescriptions: this.selectedFieldDescriptions,
      relationshipDescription: this.relationshipDescription, // ✅ Save
      objectList: this.objectList,
      select_modal: this.select_modal
    };

    try {
      fs.writeFileSync(CONTEXT_PATH, JSON.stringify(dataToSave, null, 2));
      console.log('✅ sharedContext saved to disk.');
    } catch (err) {
      console.error('❌ Failed to save sharedContext:', err);
    }
  },

  // Load from disk (if file exists)
  load() {
    if (fs.existsSync(CONTEXT_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf-8'));
        this.selectedFieldsPerObject = data.selectedFieldsPerObject || {};
        this.availableFieldsPerObject = data.availableFieldsPerObject || {};
        this.selectedFieldDescriptions = data.selectedFieldDescriptions || {};
        this.relationshipDescription = data.relationshipDescription || ''; // ✅ Load
        this.objectList = data.objectList || [];
        this.select_modal = data.select_modal || '';
        console.log('📥 sharedContext loaded from disk.');
      } catch (err) {
        console.error('❌ Failed to load sharedContext:', err);
      }
    } else {
      console.log('ℹ️ No existing sharedContext.json found. Using empty defaults.');
    }
  }
};

// Immediately try to load when this module is required
sharedContext.load();

module.exports = sharedContext;
