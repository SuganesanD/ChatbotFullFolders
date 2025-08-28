import { Routes } from '@angular/router';
import { TemplateComponent } from './template/template.component';
import { EmbedComponent } from './embed/embed.component';
import { ChatComponent } from './chat/chat.component';
import { HomeComponent } from './home/home.component';
import { UpsertComponent } from './upsert/upsert.component';


export const routes: Routes = [
    {path:"",component:HomeComponent},
    {path:"template",component:TemplateComponent},
    {path:"embed",component:EmbedComponent},
    {path:"chat",component:ChatComponent},
    {path:"upsert",component:UpsertComponent}
];
