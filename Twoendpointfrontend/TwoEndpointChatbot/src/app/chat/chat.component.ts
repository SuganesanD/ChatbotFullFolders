import { Component } from '@angular/core';
import {HttpClient} from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule,CommonModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css'
})
export class ChatComponent {
  constructor(private http:HttpClient){}
  chatInput:any;
  url="http://localhost:3000/chat"
  output:any;
  loading:boolean=false;
  generateChat(){
    this.loading=true
    const parsedInput = JSON.parse(this.chatInput);
     this.http.post<{ message: string }>(this.url, parsedInput ).subscribe({
      next:(response)=>{
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
