import {HttpClient } from '@angular/common/http';
import { Component} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';

@Component({
  selector: 'app-template',
  standalone: true,
  imports: [RouterModule,FormsModule],
  templateUrl: './template.component.html',
  styleUrl: './template.component.css'
})
export class TemplateComponent {
  constructor( private router: Router,private http:HttpClient) {}
  input:string='';
  template:any;
  url = "http://localhost:3000/generateTemplate";
  modal:string=''

generateTemplate() {
  console.log("modal:",this.modal);
  
  this.http.post<{ message: string }>(this.url, { input: this.input,modal:this.modal }).subscribe({
    next: (res) => {
      this.template = res.message;
    },
    error: (err) => {
      this.template = err.error?.message || 'Something went wrong';
    }
  });
}
}
