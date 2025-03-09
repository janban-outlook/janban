# ⚠️ PROJECT STATUS: UNMAINTAINED ⚠️

After many years of development and maintenance, I have decided to retire from active development of JanBan. As I no longer use Windows or Office personally, I've been unable to maintain the project for the past few years. 

I initially thought I might pick up development again after my retirement, but after consideration, I've decided not to purchase Windows and Office licenses or set up a new development environment specifically for this purpose.

**What this means:**
- The repository has been migrated from GitLab to GitHub to increase visibility
- No new features will be implemented by me
- I will not be able to respond to support requests
- The application is stable in its current state with no major known issues

**For users:** Thank you for your interest and support over the years. The current version should continue to work as is.

**For developers:** This project is now open for adoption! Feel free to fork the repository, make improvements, or use it as a foundation for a new version. If you're interested in becoming a maintainer or creating your own fork, please feel free to do so.

I'm grateful to everyone who used JanBan and found it helpful for their workflow. While it's difficult to step away, I hope this project can continue to evolve through the open source community.

# Outlook Kanban Taskboard aka **JanBan**

⚠️ NOTA BENE: I changed below instructions a bit, because the online version of the app is no longer available. Most of you installed it locally, so that should still work. ⚠️
⚠️ And: I have no possibility to test it, so I couldn't verify proper working anymore ⚠️

![logo](/images/janban-icon-512-300x300.jpg)

JanBan is an Outlook Taskboard that employs a kanban board style view for Outlook Tasks.

This project builds upon the [Outlook Taskboard by Evren Varol](https://github.com/evrenvarol/outlook-taskboard). I've enhanced it with numerous features, customization options, and settings adjustments.

![](/images/scr1.png)

The core features of JanBan include:

##### Moving Tasks between task lanes
![](/images/scr2.gif)

##### Filtering Tasks 
![](/images/scr3.gif)

##### Configuration
![](/images/scr4.gif) 

##### Support Mailbox
![](/images/scr5.gif)

### Supported Platforms

I've tested it with all versions of Outlook from 2013 to the present, and on Windows from version 8 to 11. It may also work with older versions of Outlook and is likely compatible with Windows 7.

You can also open the taskboard in a browser. However, due to some limitations with ActiveX controls, it only operates on Internet Explorer.


### Setup Options

You can use JanBan ~~online~~ __(no longer available)__ or set it up on your local computer. 

Regardless of how you use it, it will run in your Outlook application, and none of your Outlook data will be visible to anyone else.

Here's a breakdown of the pros and cons of each option to help you decide which is the best fit for you:

~~- Default Option:~~
  - ~~Setup: Very straightforward~~
  - ~~Updates: They occur automatically; you don't have to lift a finger.~~
  - ~~Offline: The app won't function if you're not connected to the internet.~~

- Local Option:
  - Setup: It requires some effort. 
  - Updates: You have to manually install them.
  - Offline: You can use the app even when offline.

~~### Default Setup~~

~~If you prefer an effortless setup, visit https://janware.nl/janban and follow the instructions there.~~

~~However, if you want to set it up yourself:~~

~~1. Right-click your Outlook Home Folder and then click Properties.~~
~~2. Select the _Home Page_ tab in the box that pops up.~~
~~3. In the box labeled _Address_, enter: https://janware.nl/janban.~~
~~4. Check the box that reads _Show home page by default for this folder_, then click OK.~~

### Local Setup

1. Download the janban.zip file from this repository and place it in a folder on your computer.  
2. Right-click your Outlook Home Folder and then click Properties.
3. Choose the _Home Page_ tab in the box that appears.
4. In the _Address_ box, locate the folder where you saved the Taskboard files and select the __kanban.html__ file.  
5. Check the box that reads _Show home page by default for this folder_, then click OK.

![](/images/scr6.png)

If you encounter this warning, merely click the X icon to close the warning and the Properties window. 

### Using the install-local command file

Click the download link and save the file to your Downloads folder.  

![](/images/setup1.png)

Go to your Downloads folder, right-click the janban.zip file and select Extract All  

![](/images/setup2.png)

Check the box to display the extracted files and click the Extract button  

![](/images/setup3.png)

Double-click the install.cmd file. You might briefly see a black command screen.  

![](/images/setup4.png)

If Windows presents a protection message, then click on 'More info'  

![](/images/setup5.png)

Click on 'Run anyway'  

![](/images/setup6.png) 

The installation is now complete. Open Outlook and go to your top-level mail folder. The Janban board will appear. Enjoy!

![](/images/setup7.png)
