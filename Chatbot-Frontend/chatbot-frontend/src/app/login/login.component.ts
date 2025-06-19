import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CouchdbService } from '../couchdb.service'; // Update the import path as necessary
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  username: string = '';
  password: string = '';
  errorMessage: string = '';

  constructor(private router: Router, private couchdbService: CouchdbService) {}

  onSubmit(): void {
    this.couchdbService.authenticate(this.username, this.password).subscribe(isAuthenticated => {
      if (isAuthenticated) {
        localStorage.setItem('isAuthenticated', 'true'); // Set a flag in localStorage
        this.router.navigate(['/home']);
      } else {
        this.errorMessage = 'Invalid username or password';
      }
    });
  }
}
