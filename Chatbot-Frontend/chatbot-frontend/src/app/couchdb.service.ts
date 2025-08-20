import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders,HttpErrorResponse } from '@angular/common/http';
import { Observable, of,throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

interface User {
  username: string;
  password: string;
}

interface UsersResponse {
  users: User[];
}

@Injectable({
  providedIn: 'root'
})
export class CouchdbService {
  private readonly dbUrl = 'https://192.168.57.185:5984/';
  private readonly usersUrl = `${this.dbUrl}gowtham/users`;
  private readonly findUrl = `${this.dbUrl}gowtham/_find`;
  private readonly allDocsUrl = `${this.dbUrl}gowtham/_all_docs?include_docs=true`; // URL to fetch all documents
  private readonly username = 'd_couchdb'; // Replace with your CouchDB username
  private readonly password = 'Welcome#2'; // Replace with your CouchDB password

  private apiUrl1 = 'http://localhost:3000/query';
  private apiUrl3 = 'http://localhost:3000/api/chatbot'
  private apiUrl2 = 'http://localhost:3000/isImageRender';


  constructor(private http: HttpClient) { }

  getUsers(): Observable<UsersResponse> {
    const headers = new HttpHeaders({
      'Authorization': 'Basic ' + btoa(`${this.username}:${this.password}`)
    });

    return this.http.get<UsersResponse>(this.usersUrl, { headers }).pipe(
      catchError((error) => {
        console.error('Error fetching users:', error);
        return of({ users: [] });
      })
    );
  }

  authenticate(username: string, password: string): Observable<boolean> {
    return this.getUsers().pipe(
      map((response: UsersResponse) => {
        if (!response || !response.users) {
          return false; // Return false if response is invalid
        }

        const user = response.users.find(user => user.username === username);
        return user ? user.password === password : false; // Validate credentials
      })
    );
  }

    // sendQuery(query: string): Observable<any> {
    //   console.log(query); 
    //   return this.http.post(this.apiUrl3, { query ,sessionId:"234",collectionName:"dynamicRecords",modal:"gemini"});
    // }

     sendQuery(query: string): Observable<any> {
    console.log(`Sending query: ${query}`); 
    return this.http.post(this.apiUrl3, { 
      query
      // sessionId: "234",
      // collectionName: "dynamicRecords",
      // modal: "gemini"
    })
    // .pipe(
    //   // The `catchError` operator intercepts a failed HTTP request
    //   catchError((error: HttpErrorResponse) => {
    //     console.error('Backend returned an error:', error);
        
    //     let errorMessage = 'An unknown error occurred.';

    //     // Check if the backend response has a specific error message
    //     if (error.error && error.error.error) {
    //       errorMessage = error.error.error;
    //     } else {
    //       // Fallback for other types of errors
    //       errorMessage = `Server returned code ${error.status}: ${error.message}`;
    //     }

    //     // `throwError` creates an Observable that emits an error, which
    //     // will trigger the component's `error` callback.
    //     return throwError(() => new Error(errorMessage));
    //   })
    // );
  }


  imagevalue(imagevalue:boolean): Observable<any>{  
    console.log(imagevalue)
    return this.http.post(this.apiUrl2,{imagevalue})
  }
  search(query: any): Observable<any> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(`${this.username}:${this.password}`)
    });

    return this.http.post(this.findUrl, query, { headers }).pipe(
      catchError((error) => {
        console.error('Error executing search query:', error);
        return of({ error: 'There was an error processing your request.' });
      })
    );
  }

  getAllDocs(): Observable<any> {
    const headers = new HttpHeaders({
      'Authorization': 'Basic ' + btoa(`${this.username}:${this.password}`)
    });

    return this.http.get(this.allDocsUrl, { headers }).pipe(
      catchError((error) => {
        console.error('Error fetching all documents:', error);
        return of({ error: 'There was an error processing your request.' });
      })
    );
  }
}
