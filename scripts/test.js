import { exec } from 'child_process';
const curlCommand =  "curl -X GET http://enact.education.ufl.edu/api/admin/users";

exec(curlCommand, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error}`);
    return;
  }
  console.log(`stdout: ${stdout}`);
  console.error(`stderr: ${stderr}`);
});


