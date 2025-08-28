import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-upsert',
  standalone: true,
  imports: [FormsModule,CommonModule],
  templateUrl: './upsert.component.html',
  styleUrl: './upsert.component.css'
})
export class UpsertComponent {
  constructor(private http:HttpClient){};

upsertInput:any;
url="http://localhost:3000/upsertMilvus"
output:any;
loading:boolean=false;
upsertRecords(){
  this.loading=true
   this.http.post<{ message: string }>(this.url, { input: this.upsertInput }).subscribe({
    next:(response)=>{
      console.log("response:",response);
      this.output=response.message
      console.log("output:",this.output);
      this.loading=false
    },
    error:(error)=>{
      this.output=error.error?.message || "Error Try again !"
       console.log("output:",this.output);
      this.loading=false
    }
  })
}
}
  