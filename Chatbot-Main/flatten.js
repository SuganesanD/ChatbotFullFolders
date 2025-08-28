function flattenObject(obj, parentKey = '') {
  const flattened = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = parentKey ? `${parentKey}.${key}` : key;
      const value = obj[key];

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(flattened, flattenObject(value, newKey));
      } else {
        flattened[newKey] = value;
      }
    }
  }

  return flattened;
}

const yourObject = 
 {
            "id": "pfm312529_2_205d420fd645156fbe9fb26661c4b409",
            "rev": "1-6778c9bef99a874f8ef2f1f6949e0290",
            "createdon": 1753851360915,
            "createdby": 5223,
            "lastmodifiedon": 1753851754529,
            "lastmodifiedby": 5223,
            "type": "pfm312529",
            "couch_id": "pfm312529_2_205d420fd645156fbe9fb26661c4b409",
            "couch_rev_id": "1-6778c9bef99a874f8ef2f1f6949e0290",
            "pfm_312529_id": 8,
            "annualincome": 7890,
            "pfm312489": "9c13365c2be762b3443afb49a10dd8dd",
            "address": "KR NG",
            "pfm_312489_id": 1,
            "guid": "ce71a46d6a38475",
            "contactno": null,
            "emailid": "Tests3@gmail.com",
            "display_name": "Tests3",
            "augmentsourceid": null,
            "dob": 1741564800000,
            "augmentsourcetype": null,
            "employeename": "Tests3",
            "gender": "male",
            "name": "Tests3",
            "state": "tn",
            "isactive": false,
            "testpm2parent_rel": {
                "id": "pfm312489_2_9c13365c2be762b3443afb49a10dd8dd",
                "rev": "51-ba67d27a8a0ed6388daebb1e66012c40",
                "createdon": 1741249365398,
                "createdby": 2203,
                "lastmodifiedon": 1751455201940,
                "lastmodifiedby": 2203,
                "type": "pfm312489",
                "couch_id": "pfm312489_2_9c13365c2be762b3443afb49a10dd8dd",
                "couch_rev_id": "51-ba67d27a8a0ed6388daebb1e66012c40",
                "pfm_312489_id": 1,
                "guid": "o5gcIjkKTLcrnBR",
                "name": "1",
                "augmentsourcetype": null,
                "companytype": "mnc",
                "display_name": "1",
                "address": "mdu",
                "augmentsourceid": null,
                "orgname": "Chainsys",
                "isactive": false,
                "contactno": 631,
                "emailid": null,
                "couch_ref_id": "pfm312529_2_228944d17e08b73ba3afd9bcc86f16d1"
            }
        
};

const plainObject = flattenObject(yourObject);

console.log(plainObject);