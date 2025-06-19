import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CouchdbService } from '../couchdb.service';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit, OnDestroy {
  query1: string = '';
  query:string=''
  conversation: {
    query: string;
    response: string;
    image?: string;
    sources?: { doc_id: string }[];
    isTyping?: boolean;
    isRendering?: boolean;
  }[] = [];

  errorMessage: string | null = null;
  isLoading: boolean = false;
  private currentRequest?: Subscription;  
  private typingInterval?: any;

  currentImageRenderFlag = false; 

  constructor(private router: Router, private couchService: CouchdbService ,private http: HttpClient) {}

  ngOnInit(): void {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      this.router.navigate(['/login']);
    }
  }

  onSearch(searchValue: string): void {
    this.query=this.query1
    this.query1=''
    if (this.isLoading) return;
  
    this.query = searchValue.trim();
    if (!this.query) {
      this.errorMessage = 'Enter something to search';
      return;
    }
  
    
    this.isLoading = true;
    this.errorMessage = null;
  
    this.conversation.push({ query: this.query, response: '', isTyping: true });
  
    this.currentRequest = this.couchService.sendQuery(this.query).subscribe({
      next: (data) => {
        const response = data?.answer || 'No result found';
        const image = data?.image || null;
        const sources = data?.sources || [];
        const index = this.conversation.length - 1;
  
        this.typeResponse(response, index, () => {
          if (!this.conversation[index]) return;
  
          this.conversation[index].sources = sources; 
          this.conversation[index].image = image;
        });
  
        this.query = '';
        this.errorMessage = null;
      },
      error: (error) => {
        this.errorMessage = 'There was an error processing your request';
        console.error('Error:', error);
      },
      complete: () => {
        this.isLoading = false;
      }
    });
  }
  

  typeResponse(text: string, index: number, callback?: () => void, delay: number = 0): void {
    let i = 0;
    this.typingInterval = setInterval(() => {
      if (i < text.length) {
        this.conversation[index].response += text.charAt(i);
        i++;
      } else {
        clearInterval(this.typingInterval);
        this.typingInterval = null;
        this.conversation[index].isTyping = false;
        if (callback) callback();
      }
    }, delay);
  }

  onStop(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
      const lastResponseIndex = this.conversation.length - 1;
      if (this.conversation[lastResponseIndex]) {
        this.conversation[lastResponseIndex].isTyping = false;
      }
    }
  }
 

  renderImage(index: number): void {
    const item = this.conversation[index];
    if (!item || !item.response) return;
  
    // Mark rendering state
    item.isRendering = true;
    console.log(item.response);
    // Send the specific response text to the backend
    this.http.post<{ image: string }>('http://localhost:3000/generate-image', {
      imagePrompt: item.response
    }).subscribe({
      next: (data) => {
        item.image = data.image;
        item.isRendering = false;
      },
      error: (err) => {
        console.error('Image generation error:', err);
        item.isRendering = false;
      }
    });
  }


  ngOnDestroy(): void {
    if (this.currentRequest) {
      this.currentRequest.unsubscribe();
    }
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
    }
  }
}
