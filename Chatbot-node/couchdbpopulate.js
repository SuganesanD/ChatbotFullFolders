
import { faker } from '@faker-js/faker';
import { v4 as uuidv4 } from 'uuid';
import Nano from 'nano';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config({ path: './couchdb_credentials.env' }); // load from your custom .env file


process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Ignore self-signed certs

const nano = Nano({
  url: `https://${process.env.COUCHDB_HOST}`,
  requestDefaults: {
    agent: new https.Agent({ rejectUnauthorized: false }),
    auth: {
      username: 'd_couchdb',
      password: 'Welcome#2'
    }
  }
});

const db = nano.db.use('aichatbot');

const uniqueNames = new Set();

const generateUniqueName = () => {
  let name;
  do {
    name = faker.person.firstName().toLowerCase() + ' ' + faker.person.lastName().toLowerCase();
  } while (uniqueNames.has(name));
  uniqueNames.add(name);
  return name;
};

const generateData = async () => {
  const batchSize = 500;
  let allDocs = [];

  for (let i = 1; i <= 3000; i++) {
    const fullName = generateUniqueName();
    const [firstName, lastName] = fullName.split(' ');
    const email = `${firstName}.${lastName}@example.com`;

    const employeeId = uuidv4();
    const additionalInfoId = uuidv4();
    const EmpID = `EMP_${i}`;

    const employeeDoc = {
      _id: `employee_2_${employeeId}`,
      data: {
        FirstName: firstName,
        LastName: lastName,
        EmpID: EmpID,
        StartDate: faker.date.past({ years: 5 }).toISOString().split('T')[0],
        Email: email,
        Manager:faker.helpers.arrayElement(['Aravind', 'babu','charles','dhanasekaran']),
        EmployeeStatus: faker.helpers.arrayElement(['Active', 'Terminated']),
        EmployeeType: faker.helpers.arrayElement(['Full-Time', 'Part-Time']),
        PayZone: faker.helpers.arrayElement(['Zone A', 'Zone B', 'Zone C']),
        DepartmentType: faker.helpers.arrayElement(['Software Engineer', 'Data Analyst', 'QA Engineer', 'DevOps']),
        Division: faker.helpers.arrayElement(['Engineering', 'IT', 'Support']),
        Salary: faker.number.int({ min: 30000, max: 120000 }),
        additionalinfo_id: additionalInfoId,
        type: 'employee'
      }
    };

    const additionalInfoDoc = {
      _id: `additionalinfo_2_${additionalInfoId}`,
      data: {
        DOB: faker.date.birthdate({ min: 1970, max: 2000, mode: 'year' }).toISOString().split('T')[0],
        State: faker.location.state({ abbreviated: true }),
        GenderCode: faker.person.sexType(),
        LocationCode: faker.number.int({ min: 1000, max: 9999 }),
        MaritalDesc: faker.helpers.arrayElement(['Single', 'Married', 'Divorced']),
        PerformanceScore: faker.helpers.arrayElement(['Fully Meets', 'Exceeds', 'Needs Improvement']),
        CurrentEmployeeRating: faker.number.int({ min: 1, max: 5 }),
        type: 'additionalinfo'
      }
    };

    const leaveCount = faker.number.int({ min: 1, max: 3 });
    const leaveDocs = Array.from({ length: leaveCount }, () => {
      return {
        _id: `leave_2_${uuidv4()}`,
        data: {
          date: faker.date.recent({ days: 365 }).toISOString().split('T')[0],
          type: 'leave',
          employee_id: employeeId 
        }
      };
    });

    allDocs.push(employeeDoc, additionalInfoDoc, ...leaveDocs);

    if (allDocs.length >= batchSize) {
      await db.bulk({ docs: allDocs });
      console.log(`✅ Inserted batch of ${allDocs.length} docs up to employee #${i}`);
      allDocs = [];
    }
  }

  if (allDocs.length > 0) {
    await db.bulk({ docs: allDocs });
    console.log(`✅ Inserted final batch of ${allDocs.length} docs.`);
  }

  console.log('🎉 All employee-related records inserted into CouchDB.');
};

generateData().catch(err => {
  console.error('❌ Error inserting data:', err);
});
