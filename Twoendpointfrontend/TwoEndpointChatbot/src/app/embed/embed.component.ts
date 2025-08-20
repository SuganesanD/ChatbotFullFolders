import { CommonModule } from '@angular/common';
import {HttpClient} from '@angular/common/http';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';


@Component({
  selector: 'app-embed',
  standalone: true,
  imports: [CommonModule,FormsModule,CommonModule],
  templateUrl: './embed.component.html',
  styleUrl: './embed.component.css'
})
export class EmbedComponent {

constructor(private http:HttpClient){}
embeddingInput:any;
url="http://localhost:3000/embed"
output:any;
loading:boolean=false;
generateEmbeddings(){
  this.loading=true
   this.http.post<{ message: string }>(this.url, { input: this.embeddingInput }).subscribe({
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
